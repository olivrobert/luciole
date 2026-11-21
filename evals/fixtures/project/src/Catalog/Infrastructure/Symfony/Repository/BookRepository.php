<?php

declare(strict_types=1);

namespace Catalog\Infrastructure\Symfony\Repository;

use Catalog\Domain\Enum\BookCopyStatus;
use Catalog\Domain\Enum\BookStatus;
use Catalog\Domain\Model\Book;
use Catalog\Domain\Model\Genre;
use Catalog\Domain\Repository\BookRepositoryInterface;
use Common\Repository\FilterableRepositoryTrait;
use Common\Repository\ListableRepositoryInterface;
use Common\Repository\PaginableRepositoryTrait;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\ORM\QueryBuilder;
use Doctrine\Persistence\ManagerRegistry;
use Library\Domain\Model\Library;
use Publisher\Domain\Model\Publisher;
use SharedKernel\Domain\Model\Language;

/**
 * @extends ServiceEntityRepository<Book>
 *
 * @implements ListableRepositoryInterface<Book>
 */
class BookRepository extends ServiceEntityRepository implements BookRepositoryInterface, ListableRepositoryInterface
{
    use FilterableRepositoryTrait;
    use PaginableRepositoryTrait;

    private const int NEW_ARRIVALS_DAYS = 60;

    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Book::class);
    }

    public function save(Book $book): void
    {
        $this->getEntityManager()->persist($book);
    }

    public function remove(Book $book): void
    {
        $this->getEntityManager()->remove($book);
    }

    public function findById(int $id): ?Book
    {
        return $this->find($id);
    }

    public function findByIsbn(string $isbn): ?Book
    {
        /** @var ?Book */
        return $this->createQueryBuilder('b')
            ->where('b.isbn.value = :isbn')
            ->setParameter('isbn', $isbn)
            ->getQuery()
            ->getOneOrNullResult();
    }

    /**
     * @param list<int> $ids
     *
     * @return list<Book>
     */
    public function findByIds(array $ids): array
    {
        if ([] === $ids) {
            return [];
        }

        /** @var list<Book> */
        return $this->createQueryBuilder('b')
            ->leftJoin('b.publisher', 'p')
            ->addSelect('p')
            ->where('b.id IN (:ids)')
            ->setParameter('ids', $ids)
            ->getQuery()
            ->getResult();
    }

    /**
     * @param list<string> $isbns
     *
     * @return array<string, Book>
     */
    public function findIndexedByIsbns(array $isbns): array
    {
        if ([] === $isbns) {
            return [];
        }

        /** @var list<Book> $books */
        $books = $this->createQueryBuilder('b')
            ->where('b.isbn.value IN (:isbns)')
            ->setParameter('isbns', $isbns)
            ->getQuery()
            ->getResult();

        $indexed = [];
        foreach ($books as $book) {
            $indexed[$book->isbn->value] = $book;
        }

        return $indexed;
    }

    /**
     * @return list<Book>
     */
    public function findPublishedByPublisher(Publisher $publisher): array
    {
        /** @var list<Book> */
        return $this->createQueryBuilder('b')
            ->where('b.publisher = :publisher')
            ->andWhere('b.status = :status')
            ->setParameter('publisher', $publisher)
            ->setParameter('status', BookStatus::Published)
            ->orderBy('b.title.fr', 'ASC')
            ->getQuery()
            ->getResult();
    }

    /**
     * @return list<Book>
     */
    public function findNewArrivals(Library $library, int $limit = 12): array
    {
        $since = new \DateTimeImmutable(\sprintf('-%d days', self::NEW_ARRIVALS_DAYS));

        /** @var list<Book> */
        return $this->createQueryBuilder('b')
            ->innerJoin('b.bookCopies', 'c')
            ->where('c.library = :library')
            ->andWhere('b.status = :status')
            ->andWhere('b.createdAt >= :since')
            ->setParameter('library', $library)
            ->setParameter('status', BookStatus::Published)
            ->setParameter('since', $since)
            ->groupBy('b.id')
            ->orderBy('b.createdAt', 'DESC')
            ->setMaxResults($limit)
            ->getQuery()
            ->getResult();
    }

    /**
     * @return list<Book>
     */
    public function findAvailableByGenre(Genre $genre, Library $library): array
    {
        /** @var list<Book> */
        return $this->createQueryBuilder('b')
            ->innerJoin('b.bookCopies', 'c')
            ->addSelect('c')
            ->where('b.genre = :genre')
            ->andWhere('c.library = :library')
            ->andWhere('c.status = :available')
            ->setParameter('genre', $genre)
            ->setParameter('library', $library)
            ->setParameter('available', BookCopyStatus::Available)
            ->orderBy('b.title.fr', 'ASC')
            ->getQuery()
            ->getResult();
    }

    /**
     * @return list<array{book: Book, loans: int}>
     */
    public function findMostBorrowed(Library $library, \DateTimeImmutable $since, int $limit = 10): array
    {
        /** @var list<array{book: Book, loans: int}> */
        return $this->createQueryBuilder('b')
            ->select('b AS book', 'COUNT(l.id) AS loans')
            ->innerJoin('b.bookCopies', 'c')
            ->innerJoin('c.loans', 'l')
            ->where('c.library = :library')
            ->andWhere('l.borrowedAt >= :since')
            ->setParameter('library', $library)
            ->setParameter('since', $since)
            ->groupBy('b.id')
            ->orderBy('loans', 'DESC')
            ->setMaxResults($limit)
            ->getQuery()
            ->getResult();
    }

    public function countAvailableBookCopies(Book $book, Library $library): int
    {
        return (int) $this->createQueryBuilder('b')
            ->select('COUNT(c.id)')
            ->innerJoin('b.bookCopies', 'c')
            ->where('b = :book')
            ->andWhere('c.library = :library')
            ->andWhere('c.status = :available')
            ->setParameter('book', $book)
            ->setParameter('library', $library)
            ->setParameter('available', BookCopyStatus::Available)
            ->getQuery()
            ->getSingleScalarResult();
    }

    /**
     * Withdrawn books remain visible in the loan history.
     *
     * @return list<Book>
     */
    public function findHistoryWithWithdrawn(Library $library): array
    {
        $filters = $this->getEntityManager()->getFilters();
        $filters->disable('softdeleteable');

        try {
            /** @var list<Book> */
            return $this->createQueryBuilder('b')
                ->innerJoin('b.bookCopies', 'c')
                ->where('c.library = :library')
                ->setParameter('library', $library)
                ->orderBy('b.title.fr', 'ASC')
                ->getQuery()
                ->getResult();
        } finally {
            $filters->enable('softdeleteable');
        }
    }

    /**
     * @param array{title?: string, author?: string, status?: BookStatus} $criteria
     *
     * @return list<Book>
     */
    public function search(array $criteria, int $limit = 50): array
    {
        $qb = $this->createQueryBuilder('b');

        if (isset($criteria['title'])) {
            $qb->andWhere('LOWER(b.title.fr) LIKE :title')
                ->setParameter('title', '%'.mb_strtolower($criteria['title']).'%');
        }

        if (isset($criteria['author'])) {
            $qb->innerJoin('b.authors', 'a')
                ->andWhere('LOWER(a.name) LIKE :author')
                ->setParameter('author', '%'.mb_strtolower($criteria['author']).'%');
        }

        if (isset($criteria['status'])) {
            $qb->andWhere('b.status = :status')
                ->setParameter('status', $criteria['status']);
        }

        /** @var list<Book> */
        return $qb->orderBy('b.title.fr', 'ASC')
            ->setMaxResults($limit)
            ->getQuery()
            ->getResult();
    }

    /**
     * @return list<Book>
     */
    public function findByLanguage(Language $language, int $limit = 50): array
    {
        /** @var list<Book> */
        return $this->createQueryBuilder('b')
            ->where('b.language = :language')
            ->andWhere('b.status = :status')
            ->setParameter('language', $language)
            ->setParameter('status', BookStatus::Published)
            ->orderBy('b.title.fr', 'ASC')
            ->setMaxResults($limit)
            ->getQuery()
            ->getResult();
    }

    /**
     * @return list<Book>
     */
    public function findWithoutBookCopy(): array
    {
        /** @var list<Book> */
        return $this->createQueryBuilder('b')
            ->leftJoin('b.bookCopies', 'c')
            ->where('c.id IS NULL')
            ->andWhere('b.status = :status')
            ->setParameter('status', BookStatus::Published)
            ->getQuery()
            ->getResult();
    }

    /**
     * @return array<int, int>
     */
    public function countByStatus(): array
    {
        /** @var list<array{status: BookStatus, total: int}> $rows */
        $rows = $this->createQueryBuilder('b')
            ->select('b.status AS status', 'COUNT(b.id) AS total')
            ->groupBy('b.status')
            ->getQuery()
            ->getResult();

        $counts = [];
        foreach ($rows as $row) {
            $counts[$row['status']->value] = (int) $row['total'];
        }

        return $counts;
    }

    /**
     * @param list<int> $genreIds
     *
     * @return list<Book>
     */
    public function findPublishedByGenreIds(array $genreIds): array
    {
        if ([] === $genreIds) {
            return [];
        }

        /** @var list<Book> */
        return $this->createQueryBuilder('b')
            ->where('b.genre IN (:genres)')
            ->andWhere('b.status = :status')
            ->setParameter('genres', $genreIds)
            ->setParameter('status', BookStatus::Published)
            ->orderBy('b.title.fr', 'ASC')
            ->getQuery()
            ->getResult();
    }

    /**
     * @param list<int> $authorIds
     *
     * @return array<int, list<Book>>
     */
    public function findGroupedByAuthorIds(array $authorIds): array
    {
        /** @var list<Book> $books */
        $books = $this->createQueryBuilder('b')
            ->innerJoin('b.authors', 'a')
            ->addSelect('a')
            ->where('a.id IN (:authors)')
            ->andWhere('b.status = :status')
            ->setParameter('authors', $authorIds)
            ->setParameter('status', BookStatus::Published)
            ->getQuery()
            ->getResult();

        $grouped = [];
        foreach ($books as $book) {
            foreach ($book->authors as $author) {
                if (\in_array($author->id, $authorIds, true)) {
                    $grouped[$author->id][] = $book;
                }
            }
        }

        return $grouped;
    }

    /**
     * @return list<Book>
     */
    public function findSimilar(Book $book, int $limit = 6): array
    {
        /** @var list<Book> */
        return $this->createQueryBuilder('b')
            ->where('b.genre = :genre')
            ->andWhere('b != :book')
            ->andWhere('b.status = :status')
            ->setParameter('genre', $book->genre)
            ->setParameter('book', $book)
            ->setParameter('status', BookStatus::Published)
            ->orderBy('b.createdAt', 'DESC')
            ->setMaxResults($limit)
            ->getQuery()
            ->getResult();
    }

    public function existsByIsbn(string $isbn): bool
    {
        return (int) $this->createQueryBuilder('b')
            ->select('COUNT(b.id)')
            ->where('b.isbn.value = :isbn')
            ->setParameter('isbn', $isbn)
            ->getQuery()
            ->getSingleScalarResult() > 0;
    }

    public function createListQueryBuilder(): QueryBuilder
    {
        return $this->createQueryBuilder('b')
            ->leftJoin('b.publisher', 'p')
            ->addSelect('p');
    }
}
