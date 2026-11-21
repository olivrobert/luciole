<?php

declare(strict_types=1);

namespace Fonds\Infrastructure\Symfony\Repository;

use Common\Repository\FilterableRepositoryTrait;
use Common\Repository\ListableRepositoryInterface;
use Common\Repository\PaginableRepositoryTrait;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\ORM\QueryBuilder;
use Doctrine\Persistence\ManagerRegistry;
use Editeur\Domain\Model\Editeur;
use Fonds\Domain\Enum\StatutExemplaire;
use Fonds\Domain\Enum\StatutOuvrage;
use Fonds\Domain\Model\Genre;
use Fonds\Domain\Model\Ouvrage;
use Fonds\Domain\Repository\OuvrageRepositoryInterface;
use Mediatheque\Domain\Model\Mediatheque;
use SharedKernel\Domain\Model\Langue;

/**
 * @extends ServiceEntityRepository<Ouvrage>
 *
 * @implements ListableRepositoryInterface<Ouvrage>
 */
class OuvrageRepository extends ServiceEntityRepository implements OuvrageRepositoryInterface, ListableRepositoryInterface
{
    use FilterableRepositoryTrait;
    use PaginableRepositoryTrait;

    private const int NOUVEAUTES_JOURS = 60;

    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Ouvrage::class);
    }

    public function save(Ouvrage $ouvrage): void
    {
        $this->getEntityManager()->persist($ouvrage);
    }

    public function remove(Ouvrage $ouvrage): void
    {
        $this->getEntityManager()->remove($ouvrage);
    }

    public function findById(int $id): ?Ouvrage
    {
        return $this->find($id);
    }

    public function findByIsbn(string $isbn): ?Ouvrage
    {
        /** @var ?Ouvrage */
        return $this->createQueryBuilder('o')
            ->where('o.isbn.valeur = :isbn')
            ->setParameter('isbn', $isbn)
            ->getQuery()
            ->getOneOrNullResult();
    }

    /**
     * @param list<int> $ids
     *
     * @return list<Ouvrage>
     */
    public function findByIds(array $ids): array
    {
        if ([] === $ids) {
            return [];
        }

        /** @var list<Ouvrage> */
        return $this->createQueryBuilder('o')
            ->leftJoin('o.editeur', 'e')
            ->addSelect('e')
            ->where('o.id IN (:ids)')
            ->setParameter('ids', $ids)
            ->getQuery()
            ->getResult();
    }

    /**
     * @param list<string> $isbns
     *
     * @return array<string, Ouvrage>
     */
    public function findIndexedByIsbns(array $isbns): array
    {
        if ([] === $isbns) {
            return [];
        }

        /** @var list<Ouvrage> $ouvrages */
        $ouvrages = $this->createQueryBuilder('o')
            ->where('o.isbn.valeur IN (:isbns)')
            ->setParameter('isbns', $isbns)
            ->getQuery()
            ->getResult();

        $indexed = [];
        foreach ($ouvrages as $ouvrage) {
            $indexed[$ouvrage->isbn->valeur] = $ouvrage;
        }

        return $indexed;
    }

    /**
     * @return list<Ouvrage>
     */
    public function findPubliesByEditeur(Editeur $editeur): array
    {
        /** @var list<Ouvrage> */
        return $this->createQueryBuilder('o')
            ->where('o.editeur = :editeur')
            ->andWhere('o.statut = :statut')
            ->setParameter('editeur', $editeur)
            ->setParameter('statut', StatutOuvrage::Publie)
            ->orderBy('o.titre.fr', 'ASC')
            ->getQuery()
            ->getResult();
    }

    /**
     * @return list<Ouvrage>
     */
    public function findNouveautes(Mediatheque $mediatheque, int $limite = 12): array
    {
        $depuis = new \DateTimeImmutable(\sprintf('-%d days', self::NOUVEAUTES_JOURS));

        /** @var list<Ouvrage> */
        return $this->createQueryBuilder('o')
            ->innerJoin('o.exemplaires', 'x')
            ->where('x.mediatheque = :mediatheque')
            ->andWhere('o.statut = :statut')
            ->andWhere('o.createdAt >= :depuis')
            ->setParameter('mediatheque', $mediatheque)
            ->setParameter('statut', StatutOuvrage::Publie)
            ->setParameter('depuis', $depuis)
            ->groupBy('o.id')
            ->orderBy('o.createdAt', 'DESC')
            ->setMaxResults($limite)
            ->getQuery()
            ->getResult();
    }

    /**
     * @return list<Ouvrage>
     */
    public function findDisponiblesByGenre(Genre $genre, Mediatheque $mediatheque): array
    {
        /** @var list<Ouvrage> */
        return $this->createQueryBuilder('o')
            ->innerJoin('o.exemplaires', 'x')
            ->addSelect('x')
            ->where('o.genre = :genre')
            ->andWhere('x.mediatheque = :mediatheque')
            ->andWhere('x.statut = :disponible')
            ->setParameter('genre', $genre)
            ->setParameter('mediatheque', $mediatheque)
            ->setParameter('disponible', StatutExemplaire::Disponible)
            ->orderBy('o.titre.fr', 'ASC')
            ->getQuery()
            ->getResult();
    }

    /**
     * @return list<array{ouvrage: Ouvrage, prets: int}>
     */
    public function findLesPlusEmpruntes(Mediatheque $mediatheque, \DateTimeImmutable $depuis, int $limite = 10): array
    {
        /** @var list<array{ouvrage: Ouvrage, prets: int}> */
        return $this->createQueryBuilder('o')
            ->select('o AS ouvrage', 'COUNT(p.id) AS prets')
            ->innerJoin('o.exemplaires', 'x')
            ->innerJoin('x.prets', 'p')
            ->where('x.mediatheque = :mediatheque')
            ->andWhere('p.dateEmprunt >= :depuis')
            ->setParameter('mediatheque', $mediatheque)
            ->setParameter('depuis', $depuis)
            ->groupBy('o.id')
            ->orderBy('prets', 'DESC')
            ->setMaxResults($limite)
            ->getQuery()
            ->getResult();
    }

    public function countExemplairesDisponibles(Ouvrage $ouvrage, Mediatheque $mediatheque): int
    {
        return (int) $this->createQueryBuilder('o')
            ->select('COUNT(x.id)')
            ->innerJoin('o.exemplaires', 'x')
            ->where('o = :ouvrage')
            ->andWhere('x.mediatheque = :mediatheque')
            ->andWhere('x.statut = :disponible')
            ->setParameter('ouvrage', $ouvrage)
            ->setParameter('mediatheque', $mediatheque)
            ->setParameter('disponible', StatutExemplaire::Disponible)
            ->getQuery()
            ->getSingleScalarResult();
    }

    /**
     * Les ouvrages retirés restent visibles dans l'historique des prêts.
     *
     * @return list<Ouvrage>
     */
    public function findHistoriqueAvecRetires(Mediatheque $mediatheque): array
    {
        $filters = $this->getEntityManager()->getFilters();
        $filters->disable('softdeleteable');

        try {
            /** @var list<Ouvrage> */
            return $this->createQueryBuilder('o')
                ->innerJoin('o.exemplaires', 'x')
                ->where('x.mediatheque = :mediatheque')
                ->setParameter('mediatheque', $mediatheque)
                ->orderBy('o.titre.fr', 'ASC')
                ->getQuery()
                ->getResult();
        } finally {
            $filters->enable('softdeleteable');
        }
    }

    /**
     * @param array{titre?: string, auteur?: string, statut?: StatutOuvrage} $criteres
     *
     * @return list<Ouvrage>
     */
    public function rechercher(array $criteres, int $limite = 50): array
    {
        $qb = $this->createQueryBuilder('o');

        if (isset($criteres['titre'])) {
            $qb->andWhere('LOWER(o.titre.fr) LIKE :titre')
                ->setParameter('titre', '%'.mb_strtolower($criteres['titre']).'%');
        }

        if (isset($criteres['auteur'])) {
            $qb->innerJoin('o.auteurs', 'a')
                ->andWhere('LOWER(a.nom) LIKE :auteur')
                ->setParameter('auteur', '%'.mb_strtolower($criteres['auteur']).'%');
        }

        if (isset($criteres['statut'])) {
            $qb->andWhere('o.statut = :statut')
                ->setParameter('statut', $criteres['statut']);
        }

        /** @var list<Ouvrage> */
        return $qb->orderBy('o.titre.fr', 'ASC')
            ->setMaxResults($limite)
            ->getQuery()
            ->getResult();
    }

    /**
     * @return list<Ouvrage>
     */
    public function findByLangue(Langue $langue, int $limite = 50): array
    {
        /** @var list<Ouvrage> */
        return $this->createQueryBuilder('o')
            ->where('o.langue = :langue')
            ->andWhere('o.statut = :statut')
            ->setParameter('langue', $langue)
            ->setParameter('statut', StatutOuvrage::Publie)
            ->orderBy('o.titre.fr', 'ASC')
            ->setMaxResults($limite)
            ->getQuery()
            ->getResult();
    }

    /**
     * @return list<Ouvrage>
     */
    public function findSansExemplaire(): array
    {
        /** @var list<Ouvrage> */
        return $this->createQueryBuilder('o')
            ->leftJoin('o.exemplaires', 'x')
            ->where('x.id IS NULL')
            ->andWhere('o.statut = :statut')
            ->setParameter('statut', StatutOuvrage::Publie)
            ->getQuery()
            ->getResult();
    }

    /**
     * @return array<int, int>
     */
    public function countByStatut(): array
    {
        /** @var list<array{statut: StatutOuvrage, total: int}> $rows */
        $rows = $this->createQueryBuilder('o')
            ->select('o.statut AS statut', 'COUNT(o.id) AS total')
            ->groupBy('o.statut')
            ->getQuery()
            ->getResult();

        $counts = [];
        foreach ($rows as $row) {
            $counts[$row['statut']->value] = (int) $row['total'];
        }

        return $counts;
    }

    /**
     * @param list<int> $genreIds
     *
     * @return list<Ouvrage>
     */
    public function findPubliesByGenreIds(array $genreIds): array
    {
        if ([] === $genreIds) {
            return [];
        }

        /** @var list<Ouvrage> */
        return $this->createQueryBuilder('o')
            ->where('o.genre IN (:genres)')
            ->andWhere('o.statut = :statut')
            ->setParameter('genres', $genreIds)
            ->setParameter('statut', StatutOuvrage::Publie)
            ->orderBy('o.titre.fr', 'ASC')
            ->getQuery()
            ->getResult();
    }

    /**
     * @param list<int> $auteurIds
     *
     * @return array<int, list<Ouvrage>>
     */
    public function findGroupedByAuteurIds(array $auteurIds): array
    {
        /** @var list<Ouvrage> $ouvrages */
        $ouvrages = $this->createQueryBuilder('o')
            ->innerJoin('o.auteurs', 'a')
            ->addSelect('a')
            ->where('a.id IN (:auteurs)')
            ->andWhere('o.statut = :statut')
            ->setParameter('auteurs', $auteurIds)
            ->setParameter('statut', StatutOuvrage::Publie)
            ->getQuery()
            ->getResult();

        $grouped = [];
        foreach ($ouvrages as $ouvrage) {
            foreach ($ouvrage->auteurs as $auteur) {
                if (\in_array($auteur->id, $auteurIds, true)) {
                    $grouped[$auteur->id][] = $ouvrage;
                }
            }
        }

        return $grouped;
    }

    /**
     * @return list<Ouvrage>
     */
    public function findSimilaires(Ouvrage $ouvrage, int $limite = 6): array
    {
        /** @var list<Ouvrage> */
        return $this->createQueryBuilder('o')
            ->where('o.genre = :genre')
            ->andWhere('o != :ouvrage')
            ->andWhere('o.statut = :statut')
            ->setParameter('genre', $ouvrage->genre)
            ->setParameter('ouvrage', $ouvrage)
            ->setParameter('statut', StatutOuvrage::Publie)
            ->orderBy('o.createdAt', 'DESC')
            ->setMaxResults($limite)
            ->getQuery()
            ->getResult();
    }

    public function existsByIsbn(string $isbn): bool
    {
        return (int) $this->createQueryBuilder('o')
            ->select('COUNT(o.id)')
            ->where('o.isbn.valeur = :isbn')
            ->setParameter('isbn', $isbn)
            ->getQuery()
            ->getSingleScalarResult() > 0;
    }

    public function createListQueryBuilder(): QueryBuilder
    {
        return $this->createQueryBuilder('o')
            ->leftJoin('o.editeur', 'e')
            ->addSelect('e');
    }
}
