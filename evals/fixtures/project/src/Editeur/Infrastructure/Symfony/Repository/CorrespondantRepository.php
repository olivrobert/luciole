<?php

declare(strict_types=1);

namespace Editeur\Infrastructure\Symfony\Repository;

use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use Editeur\Domain\Model\Correspondant;
use Editeur\Domain\Model\Editeur;
use Editeur\Domain\Repository\CorrespondantRepositoryInterface;

/**
 * @extends ServiceEntityRepository<Correspondant>
 */
class CorrespondantRepository extends ServiceEntityRepository implements CorrespondantRepositoryInterface
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Correspondant::class);
    }

    public function save(Correspondant $correspondant): void
    {
        $this->getEntityManager()->persist($correspondant);
    }

    public function remove(Correspondant $correspondant): void
    {
        $this->getEntityManager()->remove($correspondant);
    }

    public function findById(int $id): ?Correspondant
    {
        return $this->find($id);
    }

    /**
     * @param list<int> $editeurIds
     *
     * @return array<int, list<Correspondant>>
     */
    public function findVisiblesByEditeurIds(array $editeurIds): array
    {
        /** @var list<Correspondant> $correspondants */
        $correspondants = $this->createQueryBuilder('c')
            ->join('c.utilisateur', 'u')
            ->addSelect('u')
            ->leftJoin('c.langues', 'l')
            ->addSelect('l')
            ->where('u.editeur IN (:ids)')
            ->andWhere('c.visible = true')
            ->setParameter('ids', $editeurIds)
            ->getQuery()
            ->getResult();

        $byEditeur = [];
        foreach ($correspondants as $correspondant) {
            $editeur = $correspondant->utilisateur->editeur;
            \assert(null !== $editeur && null !== $editeur->id);
            $byEditeur[$editeur->id][] = $correspondant;
        }

        return $byEditeur;
    }

    /**
     * @return list<Correspondant>
     */
    public function findVisiblesByEditeur(Editeur $editeur): array
    {
        /** @var list<Correspondant> */
        return $this->createQueryBuilder('c')
            ->join('c.utilisateur', 'u')
            ->addSelect('u')
            ->where('u.editeur = :editeur')
            ->andWhere('c.visible = true')
            ->setParameter('editeur', $editeur)
            ->getQuery()
            ->getResult();
    }

    public function hasOtherVisibleCorrespondant(Editeur $editeur, ?int $excludeCorrespondantId): bool
    {
        $qb = $this->createQueryBuilder('c')
            ->select('COUNT(c.id)')
            ->join('c.utilisateur', 'u')
            ->where('u.editeur = :editeur')
            ->andWhere('c.visible = true')
            ->setParameter('editeur', $editeur);

        if (null !== $excludeCorrespondantId) {
            $qb->andWhere('c.id != :exclude')
                ->setParameter('exclude', $excludeCorrespondantId);
        }

        return (int) $qb->getQuery()->getSingleScalarResult() > 0;
    }
}
