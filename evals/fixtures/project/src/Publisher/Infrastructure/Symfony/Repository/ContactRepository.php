<?php

declare(strict_types=1);

namespace Publisher\Infrastructure\Symfony\Repository;

use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use Publisher\Domain\Model\Contact;
use Publisher\Domain\Model\Publisher;
use Publisher\Domain\Repository\ContactRepositoryInterface;

/**
 * @extends ServiceEntityRepository<Contact>
 */
class ContactRepository extends ServiceEntityRepository implements ContactRepositoryInterface
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Contact::class);
    }

    public function save(Contact $contact): void
    {
        $this->getEntityManager()->persist($contact);
    }

    public function remove(Contact $contact): void
    {
        $this->getEntityManager()->remove($contact);
    }

    public function findById(int $id): ?Contact
    {
        return $this->find($id);
    }

    /**
     * @param list<int> $publisherIds
     *
     * @return array<int, list<Contact>>
     */
    public function findVisibleByPublisherIds(array $publisherIds): array
    {
        /** @var list<Contact> $contacts */
        $contacts = $this->createQueryBuilder('c')
            ->join('c.user', 'u')
            ->addSelect('u')
            ->leftJoin('c.languages', 'l')
            ->addSelect('l')
            ->where('u.publisher IN (:ids)')
            ->andWhere('c.visible = true')
            ->setParameter('ids', $publisherIds)
            ->getQuery()
            ->getResult();

        $byPublisher = [];
        foreach ($contacts as $contact) {
            $publisher = $contact->user->publisher;
            \assert(null !== $publisher && null !== $publisher->id);
            $byPublisher[$publisher->id][] = $contact;
        }

        return $byPublisher;
    }

    /**
     * @return list<Contact>
     */
    public function findVisibleByPublisher(Publisher $publisher): array
    {
        /** @var list<Contact> */
        return $this->createQueryBuilder('c')
            ->join('c.user', 'u')
            ->addSelect('u')
            ->where('u.publisher = :publisher')
            ->andWhere('c.visible = true')
            ->setParameter('publisher', $publisher)
            ->getQuery()
            ->getResult();
    }

    public function hasOtherVisibleContact(Publisher $publisher, ?int $excludeContactId): bool
    {
        $qb = $this->createQueryBuilder('c')
            ->select('COUNT(c.id)')
            ->join('c.user', 'u')
            ->where('u.publisher = :publisher')
            ->andWhere('c.visible = true')
            ->setParameter('publisher', $publisher);

        if (null !== $excludeContactId) {
            $qb->andWhere('c.id != :exclude')
                ->setParameter('exclude', $excludeContactId);
        }

        return (int) $qb->getQuery()->getSingleScalarResult() > 0;
    }
}
